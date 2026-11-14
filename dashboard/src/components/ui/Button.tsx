import type { ComponentPropsWithRef } from "react";

type ButtonProps = ComponentPropsWithRef<"button"> & {
  tone?: "primary" | "subtle" | "ghost" | "danger" | "warning" | "success";
  size?: "default" | "small";
  busy?: boolean;
};
export default function Button({ tone = "subtle", size = "default", busy = false, disabled, className = "", children, type = "button", ...props }: ButtonProps) {
  return <button {...props} type={type} disabled={disabled || busy} aria-busy={busy || undefined}
    className={`btn ${tone} ${size === "small" ? "btn-sm" : ""} ${className}`}>
    {children}
  </button>;
}
