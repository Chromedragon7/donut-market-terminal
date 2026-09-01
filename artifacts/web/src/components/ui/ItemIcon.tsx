import { stringToColor } from "@/lib/utils";

interface ItemIconProps {
  itemId: string;
  className?: string;
}

export function ItemIcon({ itemId, className = "" }: ItemIconProps) {
  const color = stringToColor(itemId);
  
  return (
    <div 
      className={`relative overflow-hidden rounded-sm flex-shrink-0 flex items-center justify-center font-mono text-[10px] font-bold text-white shadow-inner ${className}`}
      style={{ backgroundColor: color }}
      title={itemId}
    >
      <div className="absolute inset-0 opacity-20 bg-[linear-gradient(45deg,transparent_25%,rgba(255,255,255,0.3)_50%,transparent_75%,transparent_100%)] bg-[length:200%_200%] animate-pulse" />
      <div className="absolute inset-0 shadow-[inset_0_0_8px_rgba(0,0,0,0.5)]" />
      <span className="z-10 mix-blend-overlay opacity-80">{itemId.substring(0, 2).toUpperCase()}</span>
    </div>
  );
}
