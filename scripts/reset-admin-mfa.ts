if (process.env.CONFIRM_ADMIN_MFA_RESET !== 'RESET_MFA') {
  console.error('拒绝执行：请设置 CONFIRM_ADMIN_MFA_RESET=RESET_MFA');
  process.exit(1);
}
const { db } = await import('../server/db.js');
const current = db.getAdminSecurity();
db.saveAdminSecurity({
  id: 'primary',
  totpEnabled: false,
  recoveryCodeHashes: [],
  pendingRecoveryHashes: [],
  updatedAt: new Date().toISOString(),
  authVersion: current?.authVersion,
});
db.revokeAdminSessions();
console.log('管理员 MFA 已重置，下次登录将重新绑定 TOTP。');
db.close();