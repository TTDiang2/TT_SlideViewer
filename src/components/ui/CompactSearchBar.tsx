'use client';

import React, { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motionTransitions } from '@/lib/motion-tokens';

export interface CompactSearchBarProps {
  /** Current search input value. */
  value: string;
  /** Text change handler. */
  onChange: (value: string) => void;
  /** Submit handler fired on Enter. */
  onSubmit?: (value: string) => void;
  /** Placeholder text. */
  placeholder?: string;
  /** Disables input. */
  disabled?: boolean;
  /** Auto focus on mount. */
  autoFocus?: boolean;
  /** Custom CSS class names. */
  className?: string;
}

/**
 * CompactSearchBar — easyui's IOSSearchBar adapted for the sidebar: fixed
 * width, 8px-radius field, token colors. Focus lifts the field with a soft
 * border/bgc spring; the clear button pops in with a scale spring.
 */
export const CompactSearchBar: React.FC<CompactSearchBarProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder = '搜索…',
  disabled = false,
  autoFocus = false,
  className,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClear = () => {
    onChange('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && onSubmit) {
      e.preventDefault();
      onSubmit(value);
    } else if (e.key === 'Escape') {
      inputRef.current?.blur();
    }
  };

  return (
    <div className={cn('relative flex items-center w-full', className)}>
      <motion.div
        animate={{
          borderColor: isFocused
            ? 'var(--border-strong)'
            : 'var(--border-subtle)',
        }}
        transition={motionTransitions.easeSoft}
        className={cn(
          'relative flex w-full items-center h-8 rounded-lg border bg-background px-2.5',
          'transition-colors',
          !isFocused && 'hover:border-[var(--border-strong)]',
        )}
      >
        <motion.span
          animate={{ color: isFocused ? 'var(--accent)' : 'var(--text-tertiary)' }}
          transition={motionTransitions.easeSoft}
          className="mr-2 flex shrink-0 items-center"
        >
          <Search className="w-3.5 h-3.5" strokeWidth={1.5} />
        </motion.span>

        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full bg-transparent text-xs text-foreground placeholder:text-tertiary focus:outline-none focus:ring-0 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:hidden [&::-webkit-search-results-button]:hidden [&::-webkit-search-results-decoration]:hidden disabled:opacity-40 disabled:cursor-not-allowed"
        />

        <AnimatePresence>
          {value.length > 0 && (
            <motion.button
              type="button"
              onClick={handleClear}
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={motionTransitions.springSnappy}
              aria-label="清空搜索"
              className="ml-1.5 flex shrink-0 cursor-pointer rounded-full p-0.5 text-tertiary transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <X className="w-3 h-3" strokeWidth={1.5} />
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};
