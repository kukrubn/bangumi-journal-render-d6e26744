"use client";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "./ui/input";

export function PasswordField({ create = false }: { create?: boolean }) {
  const [visible, setVisible] = useState(false);
  return (
    <label>
      {create ? "设置密码" : "密码"}
      <span className="password-input">
        <Input
          required
          name="password"
          type={visible ? "text" : "password"}
          minLength={create ? 8 : undefined}
          autoComplete={create ? "new-password" : "current-password"}
          placeholder={create ? "至少 8 个字符" : "输入登录密码"}
        />
        <button
          type="button"
          className="icon-btn"
          aria-label={visible ? "隐藏密码" : "显示密码"}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
    </label>
  );
}
