// 注销账号的确认短语。
//
// 单独放一个文件、而不是直接写进三份字典，是为了让服务端只引入这三条短语——
// 否则为了取它们就得 import 整份字典（约 520 条界面文案）进服务端 bundle。
// 三份字典各自引用这里的常量填入 workspace.deleteAccountPhrase，单一来源仍然成立，
// 改一处会同时流向前端与服务端。
//
// 注意：导出类型必须是宽化的 string，不能写成 as const 的字面量类型——
// 字典的键类型由 typeof zhCN 推导，一旦收窄成字面量，en.ts / zh-TW.ts 的赋值会直接编译失败。
export const DELETE_ACCOUNT_PHRASE_ZH_CN = '我确认注销';
export const DELETE_ACCOUNT_PHRASE_ZH_TW = '我確認註銷';
export const DELETE_ACCOUNT_PHRASE_EN = 'delete my account';

// 服务端接受的短语集合（三种界面语言各一条）。顺序无关紧要：比对用的是 includes，
// 不是按下标取值。声明为 readonly——它直接决定认证校验的行为，不该被引入方改写。
// （上面那句「不要加 as const」只针对三个字符串常量：它们若收窄成字面量，字典的键类型
//   会跟着收窄，en.ts / zh-TW.ts 直接编译失败；数组本身不受这条影响。）
export const DELETE_ACCOUNT_PHRASES: readonly string[] = [
  DELETE_ACCOUNT_PHRASE_ZH_CN,
  DELETE_ACCOUNT_PHRASE_ZH_TW,
  DELETE_ACCOUNT_PHRASE_EN,
];
