import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "./utils";

/*
 * Sizes are expressed in the doc's 2px spacing base, so `22` is 44px — the WCAG 2.1 AAA
 * touch target the accessibility section calls out as critical given the 12px body text.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-4 whitespace-nowrap text-body font-medium transition-[background-color,color,opacity,transform] duration-200 ease-brand disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-ink text-on-ink shadow-card hover:opacity-88 active:scale-[0.99]",
        outline: "border border-ink bg-transparent text-ink hover:bg-ink hover:text-on-ink",
        ghost: "bg-transparent text-ink hover:bg-ink/6",
        onInk: "bg-on-ink text-ink hover:opacity-88 active:scale-[0.99]",
      },
      size: {
        default: "min-h-22 rounded-md px-11 py-6",
        sm: "min-h-22 rounded-sm px-8 py-4",
        icon: "size-22 rounded-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
