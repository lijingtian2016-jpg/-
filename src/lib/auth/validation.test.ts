import { describe, expect, it } from "vitest";

import { mapAuthError, validateAuthForm } from "./validation";

describe("validateAuthForm", () => {
  it("rejects an invalid email address", () => {
    expect(validateAuthForm("login", "not-an-email", "password123")).toBe(
      "请输入有效的邮箱地址",
    );
  });

  it("rejects a password shorter than eight characters", () => {
    expect(validateAuthForm("login", "user@example.com", "short")).toBe(
      "密码至少需要 8 位",
    );
  });

  it("rejects mismatched registration passwords", () => {
    expect(
      validateAuthForm(
        "register",
        "user@example.com",
        "password123",
        "password456",
      ),
    ).toBe("两次输入的密码不一致");
  });

  it("accepts valid login credentials", () => {
    expect(validateAuthForm("login", "user@example.com", "password123")).toBe(
      null,
    );
  });

  it("accepts a valid email address with surrounding spaces", () => {
    expect(
      validateAuthForm("login", "  user@example.com  ", "password123"),
    ).toBe(null);
  });
});

describe("mapAuthError", () => {
  it.each([
    ["Invalid login credentials", "邮箱或密码错误"],
    ["User already registered", "该邮箱已经注册，请直接登录"],
    ["Email rate limit exceeded", "操作过于频繁，请稍后再试"],
    ["Captcha verification process failed", "人机验证失败，请重试"],
    ["captcha protection: request disallowed", "人机验证失败，请重试"],
    ["Password is too weak", "密码不符合安全要求"],
    ["Failed to fetch", "网络异常，请稍后重试"],
    ["Network request failed", "网络异常，请稍后重试"],
    ["Something unexpected happened", "操作失败，请稍后重试"],
  ])("maps %s to a user-friendly message", (message, expected) => {
    expect(mapAuthError(message)).toBe(expected);
  });
});
