'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motionTransitions } from '@/lib/motion-tokens';

export interface MorphingDialogProps {
  /** Controlled open state (the app opens dialogs programmatically). */
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Optional icon rendered before the title. */
  icon?: React.ReactNode;
  /** Hide the header close button (footer actions still close). */
  hideClose?: boolean;
  children: React.ReactNode;
  /** Max width class, e.g. max-w-lg / max-w-xl. */
  widthClass?: string;
  className?: string;
  bodyClassName?: string;
}

/**
 * MorphingDialog — easyui's spring dialog, adapted to a controlled API and
 * the app theme tokens. Surfaces scale up with a soft spring and settle;
 * content fades in staged (title → body) for a natural reveal.
 */
export const MorphingDialog: React.FC<MorphingDialogProps> = ({
  open,
  onClose,
  title,
  subtitle,
  icon,
  hideClose,
  children,
  widthClass = 'max-w-lg',
  className,
  bodyClassName,
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionTransitions.easeSoft}
            onClick={onClose}
            className="absolute inset-0 bg-black/55"
            style={{ backdropFilter: 'blur(6px)' }}
          />

          {/* Expanded morphing surface */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={motionTransitions.springMorph}
            className={cn(
              'relative w-full overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-float z-10',
              widthClass,
              className,
            )}
          >
            {/* Header */}
            <div className="flex items-start gap-2.5 border-b border-border px-5 py-4">
              {icon && (
                <div className="mt-0.5 text-primary shrink-0">{icon}</div>
              )}
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-medium text-foreground tracking-tight">
                  {title}
                </h3>
                {subtitle && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {subtitle}
                  </p>
                )}
              </div>
              {!hideClose && (
                <button
                  onClick={onClose}
                  className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-tertiary transition-colors hover:bg-surface-hover hover:text-foreground focus-ring cursor-pointer"
                  aria-label="关闭"
                >
                  <X className="h-4 w-4" strokeWidth={1.5} />
                </button>
              )}
            </div>

            {/* Body */}
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={motionTransitions.easeSoft}
              className={cn('px-5 py-4', bodyClassName)}
            >
              {children}
            </motion.div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
