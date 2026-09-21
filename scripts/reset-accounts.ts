if (process.env.CONFIRM_ACCOUNT_RESET !== 'RESET_ACCOUNTS') {
  console.error('拒绝执行：请设置 CONFIRM_ACCOUNT_RESET=RESET_ACCOUNTS');
  process.exit(1);
}
const { db } = await import('../server/db.js');
db.clearAllUsers();
db.dropLegacyAccountTables();
console.log('账号、会话、订单和遗留表已清空；skills 与 system_config 已保留。');
db.close();