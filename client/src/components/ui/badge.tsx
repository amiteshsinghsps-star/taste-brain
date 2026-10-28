import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100',
        secondary: 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200',
        success: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
        destructive: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
        warning: 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100',
        outline: 'text-slate-950 border-slate-300 bg-white/70',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge };
