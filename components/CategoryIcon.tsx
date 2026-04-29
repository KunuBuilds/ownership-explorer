import {
  Car,
  Smartphone,
  Gamepad2,
  HeartPulse,
  House,
  Megaphone,
  Newspaper,
  PawPrint,
  ShoppingBag,
  Store,
  Globe,
  Shield,
  Dumbbell,
  Wifi,
  Plane,
  Utensils,
  Landmark,
  Gem,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  'car':          Car,
  'smartphone':   Smartphone,
  'gamepad-2':    Gamepad2,
  'heart-pulse':  HeartPulse,
  'house':        House,
  'megaphone':    Megaphone,
  'newspaper':    Newspaper,
  'paw-print':    PawPrint,
  'shopping-bag': ShoppingBag,
  'store':        Store,
  'globe':        Globe,
  'shield':       Shield,
  'dumbbell':     Dumbbell,
  'wifi':         Wifi,
  'plane':        Plane,
  'utensils':     Utensils,
  'landmark':     Landmark,
  'gem':          Gem,
  'sparkles':     Sparkles,
}

interface CategoryIconProps {
  name:       string | null
  size?:      number
  color?:     string
  className?: string
}

export default function CategoryIcon({ name, size = 14, color, className }: CategoryIconProps) {
  if (!name) return null
  const Icon = ICON_MAP[name]
  if (!Icon) return null
  return (
    <Icon
      size={size}
      color={color ?? 'currentColor'}
      className={className}
      strokeWidth={1.5}
    />
  )
}