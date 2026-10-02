// 复制文本到剪贴板。
// HTTP 直连（非安全上下文）下浏览器不提供 navigator.clipboard，必须回退到 execCommand，
// 否则点击复制会毫无反应且不报错。返回是否复制成功。
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 权限被拒或非安全上下文，继续尝试兼容方案
  }
  try {
    const holder = document.createElement('textarea');
    holder.value = text;
    holder.style.position = 'fixed';
    holder.style.opacity = '0';
    document.body.appendChild(holder);
    holder.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(holder);
    return copied;
  } catch {
    return false;
  }
}
