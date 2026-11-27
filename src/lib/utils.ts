import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...names: ClassValue[]) {
  return twMerge(clsx(names));
}
