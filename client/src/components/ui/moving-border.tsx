"use client";
import React from "react";
import { cn } from "../../lib/utils";

export const MovingBorder = ({
  children,
  duration = 2000,
  className,
  containerClassName,
  borderClassName,
  as: Component = "button",
  ...otherProps
}: {
  children: React.ReactNode;
  duration?: number;
  className?: string;
  containerClassName?: string;
  borderClassName?: string;
  as?: any;
  [key: string]: any;
}) => {
  return (
    <Component
      className={cn(
        "relative h-auto w-auto overflow-hidden bg-transparent p-[1px] cursor-pointer",
        containerClassName
      )}
      {...otherProps}
    >
      <div
        className={cn(
          "absolute inset-0",
          borderClassName
        )}
        style={{
          background: `conic-gradient(from var(--angle, 0deg), transparent 60%, #3b82f6, #06b6d4, #3b82f6, transparent 40%)`,
          animation: `spin ${duration}ms linear infinite`,
        }}
      />
      <div
        className={cn(
          "relative flex items-center justify-center gap-2 backdrop-blur-xl",
          className
        )}
      >
        {children}
      </div>
    </Component>
  );
};
