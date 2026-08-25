export type AuthMode = "login" | "register";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateAuthForm(
  mode: AuthMode,
  email: string,
  password: string,
  confirmPassword = "",
): string | null {
  if (!EMAIL_PATTERN.test(email)) {
    return "请输入有效的邮箱地址";
  }

  if (password.length < 8) {
    return "密码至少需要 8 位";
  }

  if (mode === "register" && password !== confirmPassword) {
    return "两次输入的密码不一致";
  }

  return null;
}

export function mapAuthError(message: string): string {
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("invalid login credentials")) {
    return "邮箱或密码错误";
  }

  if (normalizedMessage.includes("user already registered")) {
    return "该邮箱已经注册，请直接登录";
  }

  if (normalizedMessage.includes("rate limit")) {
    return "操作过于频繁，请稍后再试";
  }

  if (normalizedMessage.includes("password")) {
    return "密码至少需要 8 位";
  }

  if (
    normalizedMessage.includes("fetch") ||
    normalizedMessage.includes("network")
  ) {
    return "网络连接失败，请稍后重试";
  }

  return "操作失败，请稍后重试";
}
