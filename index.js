const PLUGIN_OWNER_ID = 'plugin:clan-role-manager';
const GROUP_NAME_MEMBER = 'Member';
const GROUP_NAME_ADMIN = 'Admin';
const STORE_KEY = 'clan_members';

async function onLoad(bot, { settings, store }) {
    const log = bot.sendLog;
    const checkedUsersInClanChat = new Set();
    const clanMembers = new Set();

    // Загрузка сохраненного списка членов клана из хранилища плагина
    try {
        const storedMembers = await store.get(STORE_KEY);
        if (storedMembers && typeof storedMembers === 'string') {
            storedMembers.split(',').forEach(nick => {
                const cleanNick = nick.trim().toLowerCase();
                if (cleanNick) clanMembers.add(cleanNick);
            });
        }
    } catch (e) {
        log(`[ClanRoleManager] Ошибка загрузки списка членов клана из БД: ${e.message}`);
    }

    // Вспомогательная функция сохранения списка в БД в формате CSV
    async function saveMembersToStore() {
        try {
            const csvList = Array.from(clanMembers).join(', ');
            await store.set(STORE_KEY, csvList);
        } catch (e) {
            log(`[ClanRoleManager] Ошибка сохранения членов клана в БД: ${e.message}`);
        }
    }

    async function setupRolesAndPermissions() {
        try {
            log('[ClanRoleManager] Регистрация прав и групп...');
            const memberPermissions = [
                { name: 'member.*', description: 'Все права участника клана', owner: PLUGIN_OWNER_ID },
                { name: 'member.say', description: 'Право использовать базовые команды', owner: PLUGIN_OWNER_ID }
            ];
            
            await bot.api.registerPermissions(memberPermissions);
            
            await bot.api.registerGroup({
                name: GROUP_NAME_MEMBER,
                owner: PLUGIN_OWNER_ID,
                permissions: ['member.say']
            });

            await bot.api.addPermissionsToGroup(GROUP_NAME_ADMIN, ["member.*"]);

            log('[ClanRoleManager] Права и группы успешно настроены.');
        } catch (error) {
            log(`[ClanRoleManager] Критическая ошибка при регистрации прав: ${error.message}`);
        }
    }

    await setupRolesAndPermissions();

    async function grantMemberRole(username) {
        if (!username) return;
        const lowerName = username.toLowerCase();

        try {
            const user = await bot.api.getUser(username);
            if (!user.hasGroup(GROUP_NAME_MEMBER)) {
                await user.addGroup(GROUP_NAME_MEMBER);
                log(`[ClanRoleManager] Пользователю ${username} выдана роль ${GROUP_NAME_MEMBER}.`);
            }

            // Добавляем в локальную БД, если еще нет
            if (!clanMembers.has(lowerName)) {
                clanMembers.add(lowerName);
                await saveMembersToStore();
            }
        } catch (error) {
            log(`[ClanRoleManager] Ошибка при выдаче роли ${username}: ${error.message}`);
        }
    }

    async function revokeMemberRole(username) {
        if (!username) return;
        const lowerName = username.toLowerCase();

        try {
            const user = await bot.api.getUser(username);
            if (user.hasGroup(GROUP_NAME_MEMBER)) {
                await user.removeGroup(GROUP_NAME_MEMBER);
                log(`[ClanRoleManager] У пользователя ${username} отозвана роль ${GROUP_NAME_MEMBER}.`);
            }

            // Удаляем из локальной БД
            if (clanMembers.has(lowerName)) {
                clanMembers.delete(lowerName);
                await saveMembersToStore();
            }
        } catch (error) {
            log(`[ClanRoleManager] Ошибка при отзыве роли у ${username}: ${error.message}`);
        }
    }

    const onPlayerJoined = (data) => data?.username && grantMemberRole(data.username);
    const onPlayerLeft = (data) => data?.username && revokeMemberRole(data.username);
    
    const onChatMessage = async (data) => {
        if (data.type !== 'clan') return;
        
        const { username } = data;
        if (!username) return;

        const lowerName = username.toLowerCase();
        if (!checkedUsersInClanChat.has(lowerName)) {
            try {
                await grantMemberRole(username);
                checkedUsersInClanChat.add(lowerName);
            } catch (error) {
                log(`[ClanRoleManager] Ошибка при проверке/выдаче роли в клан-чате для ${username}: ${error.message}`);
            }
        }
    };

    bot.events.on('clan:player_joined', onPlayerJoined);
    bot.events.on('clan:player_left', onPlayerLeft);
    bot.events.on('clan:player_kicked', onPlayerLeft);
    bot.events.on('chat:message', onChatMessage);

    bot.once('end', () => {
        bot.events.removeListener('clan:player_joined', onPlayerJoined);
        bot.events.removeListener('clan:player_left', onPlayerLeft);
        bot.events.removeListener('clan:player_kicked', onPlayerLeft);
        bot.events.removeListener('chat:message', onChatMessage);
        log('[ClanRoleManager] Слушатели событий отключены.');
    });

    log(`[ClanRoleManager] Плагин загружен. Членов клана в базе данных: ${clanMembers.size}`);
}

async function onUnload({ botId, prisma }) {
    try {
        await prisma.command.deleteMany({ where: { botId, owner: PLUGIN_OWNER_ID } });
        await prisma.permission.deleteMany({ where: { botId, owner: PLUGIN_OWNER_ID } });
        await prisma.group.deleteMany({ where: { botId, name: GROUP_NAME_MEMBER, owner: PLUGIN_OWNER_ID } });
        console.log(`[${PLUGIN_OWNER_ID}] Ресурсы плагина для бота ID ${botId} успешно удалены из БД.`);
    } catch (error) {
        console.error(`[${PLUGIN_OWNER_ID}] Ошибка при очистке ресурсов:`, error);
    }
}

module.exports = {
    onLoad,
    onUnload
};