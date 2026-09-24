"use client";
import { useMemo } from "react";
import { cn } from "../../lib/utils";

export const Meteors = ({
  number = 12,
  className,
}: {
  number?: number;
  className?: string;
}) => {
  const meteors = useMemo(() => new Array(number).fill(null).map((_, idx) => {
    // Stable pseudo-random values keep the decoration deterministic between renders.
    const seed = ((idx + 1) * 9301 + number * 49297) % 233280 / 233280;
    return {
      id: idx,
      left: Math.floor(seed * 800 - 400),
      delay: (seed * 0.6) + 0.2,
      duration: Math.floor(seed * 8 + 2),
    };
  }), [number]);
  return (
    <>
      {meteors.map((meteor) => (
        <span
          key={"meteor" + meteor.id}
          className={cn(
            "animate-meteor-effect absolute h-0.5 w-0.5 rounded-full bg-slate-400 shadow-[0_0_0_1px_#ffffff10] rotate-[215deg]",
            "before:content-[''] before:absolute before:top-1/2 before:transform before:-translate-y-[50%] before:w-[50px] before:h-[1px] before:bg-gradient-to-r before:from-[#64748b] before:to-transparent",
            className
          )}
          style={{
            top: 0,
            left: `${meteor.left}px`,
            animationDelay: `${meteor.delay}s`,
            animationDuration: `${meteor.duration}s`,
          }}
        />
      ))}
    </>
  );
};
