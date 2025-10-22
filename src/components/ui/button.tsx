import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-semibold ring-offset-background transition-all duration-150 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:bg-[hsl(var(--muted))] disabled:text-[hsl(var(--muted-foreground))] disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] rounded-lg hover:bg-[hsl(var(--primary-hover))] hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(0,0,0,0.08)] active:bg-[hsl(var(--primary-active))] active:translate-y-0 active:shadow-none",
        destructive: "bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(0,0,0,0.08)] active:translate-y-0 active:shadow-none",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-lg",
        secondary: "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] border border-[hsl(var(--secondary-border))] rounded-lg hover:bg-[hsl(var(--secondary-hover))] hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(0,0,0,0.08)] active:bg-[hsl(var(--secondary-active))] active:translate-y-0 active:shadow-none",
        tertiary: "bg-[hsl(var(--tertiary))] text-[hsl(var(--tertiary-foreground))] border border-[hsl(var(--tertiary-border))] rounded-lg font-medium hover:bg-[hsl(var(--tertiary-hover))] hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(0,0,0,0.08)] active:bg-[hsl(var(--tertiary-active))] active:translate-y-0 active:shadow-none",
        ghost: "hover:bg-accent hover:text-accent-foreground rounded-lg",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-[18px] py-2.5",
        sm: "h-9 rounded-lg px-3",
        lg: "h-11 rounded-lg px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
