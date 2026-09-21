// 把数据库中已存的协议正文重置为代码里的最新版本。
//
// 背景：协议正文保存在 system_config 的 llm_config 中，后台「协议」页可编辑。
// 因此修改 src/data/initialData.ts 里的 DEFAULT_* 只对**新建的库**生效，
// 已部署的实例读的是库里存的那一份，必须靠本脚本（或后台手动粘贴）才会更新。
//
// 用法：CONFIRM_AGREEMENT_SYNC=SYNC npm run agreements:sync
import { DEFAULT_USER_AGREEMENT, DEFAULT_PRIVACY_POLICY } from '../src/data/initialData.js';

// 确认变量必须在 import db 之前检查：server/db.ts 在模块求值时就执行 new Database()，
// 会建目录、建表、跑迁移并写种子数据。若把 import 放在前面，操作员只是想看一眼用法提示，
// 也已经对 DATA_DIR 指向的库动过手了。同目录的 reset-accounts / reset-admin-mfa 用的是同样写法。
if (process.env.CONFIRM_AGREEMENT_SYNC !== 'SYNC') {
  console.error('本脚本会用代码中的版本覆盖数据库里的协议正文。');
  console.error('⚠️  若你曾在后台「协议」页手动改过正文，那些改动会被覆盖。');
  console.error('确认继续请重跑：');
  console.error('  CONFIRM_AGREEMENT_SYNC=SYNC npm run agreements:sync');
  process.exit(1);
}

const { db } = await import('../server/db.js');

const current = db.getLLMConfig();
const before = current.agreements;

if (!before) {
  console.error('❌ 库中没有协议配置。请先启动一次服务完成初始化，再运行本脚本。');
  db.close();
  process.exit(1);
}

const alreadyLatest =
  before.userAgreementContent === DEFAULT_USER_AGREEMENT &&
  before.privacyPolicyContent === DEFAULT_PRIVACY_POLICY;

if (alreadyLatest) {
  console.log('✅ 数据库中的协议正文已与代码中的版本一致，无需更新。');
  // getLLMConfig() 在解密失败（APP_ENCRYPTION_KEY 与建库时不一致）时会静默回退到默认配置，
  // 而默认配置的正文恰好就是 DEFAULT_*，于是这里会误报「一致」——其实库里的正文根本没被读到。
  console.log('   注意：若上方日志出现过「LLM 配置读取失败」，说明密钥不匹配，本判断不可信。');
  db.close();
  process.exit(0);
}

console.log('即将更新：');
console.log(`  用户服务协议：${before.userAgreementContent.length} → ${DEFAULT_USER_AGREEMENT.length} 字符`);
console.log(`  隐私政策：    ${before.privacyPolicyContent.length} → ${DEFAULT_PRIVACY_POLICY.length} 字符`);

db.saveLLMConfig({
  ...current,
  agreements: {
    ...before,
    userAgreementContent: DEFAULT_USER_AGREEMENT,
    privacyPolicyContent: DEFAULT_PRIVACY_POLICY,
  },
});

const after = db.getLLMConfig().agreements!;
console.log('✅ 协议已更新');
console.log(`  用户服务协议：${DEFAULT_USER_AGREEMENT.length} 字符`);
console.log(`  隐私政策：    ${DEFAULT_PRIVACY_POLICY.length} 字符`);
console.log(`  生效日期：${before.updatedAt} → ${after.updatedAt}`);
db.close();
