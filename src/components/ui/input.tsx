import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Local variant of the shadcn/ui Input, using this collection's shared form colors.
export function Input({ type, className, ...props }: ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        "w-full min-w-0 rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-red-600",
        className,
      )}
      {...props}
    />
  );
}
