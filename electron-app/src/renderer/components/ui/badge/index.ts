import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Badge } from "./Badge.vue"

export const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-[0.01em] w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-eucalyptus-300/50 bg-eucalyptus-50 text-eucalyptus-700 [a&]:hover:bg-eucalyptus-100",
        secondary:
          "border-transparent bg-cream-200 text-ink-700 [a&]:hover:bg-cream-300",
        destructive:
         "border-rose-accent/30 bg-rose-accent/10 text-rose-accent [a&]:hover:bg-rose-accent/15 focus-visible:ring-destructive/20",
        outline:
          "border-border text-ink-600 [a&]:hover:bg-accent",
        success:
          "border-eucalyptus-300/50 bg-eucalyptus-50 text-eucalyptus-700 [a&]:hover:bg-eucalyptus-100",
        warning:
          "border-amber-accent/30 bg-amber-accent/10 text-amber-accent [a&]:hover:bg-amber-accent/15",
        info:
          "border-transparent bg-ink-800 text-cream-50 [a&]:hover:bg-ink-700",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)
export type BadgeVariants = VariantProps<typeof badgeVariants>
