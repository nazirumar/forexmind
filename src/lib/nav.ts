/**
 * Central nav definition shared by the desktop sidebar and the mobile
 * top-nav so the two never drift out of sync. Add a route here once
 * and it shows up in both places.
 */
import {
  LayoutDashboard,
  MessageSquare,
  Calculator,
  BookOpen,
  Newspaper,
  ShieldCheck,
  ClipboardList,
  CalendarClock,
  Target,
  GitCompareArrows,
  Eye,
  Gauge,
  PieChart,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
};

export const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
    description: "Overview of all tools",
  },
  {
    label: "AI Chat",
    href: "/chat",
    icon: MessageSquare,
    description: "Ask forex & risk questions",
  },
  {
    label: "Risk Calculator",
    href: "/risk-calculator",
    icon: Calculator,
    description: "Position size, RR, pip value",
  },
  {
    label: "Risk Dashboard",
    href: "/risk",
    icon: Gauge,
    description: "R-multiples, expectancy, exposure",
  },
  {
    label: "Analytics",
    href: "/analytics",
    icon: PieChart,
    description: "Breakdown by session, strategy, emotion",
  },
  {
    label: "Trade Journal",
    href: "/journal",
    icon: BookOpen,
    description: "Log trades and review stats",
  },
  {
    label: "Market News",
    href: "/news",
    icon: Newspaper,
    description: "Headlines + AI market brief",
  },
  {
    label: "Calendar",
    href: "/calendar",
    icon: CalendarClock,
    description: "Economic events + no-trade windows",
  },
  {
    label: "Plan Coach",
    href: "/plan",
    icon: ClipboardList,
    description: "Pre-trade plan vs your rules",
  },
  {
    label: "Trade Checker",
    href: "/checker",
    icon: ShieldCheck,
    description: "Validate an idea vs your rules",
  },
  {
    label: "Goals",
    href: "/goals",
    icon: Target,
    description: "Discipline rules + violation report",
  },
  {
    label: "Replay",
    href: "/replay",
    icon: GitCompareArrows,
    description: "What-if simulator for past trades",
  },
  {
    label: "Watchlist",
    href: "/watchlist",
    icon: Eye,
    description: "Watched pairs + price alerts",
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    description: "Profile + trading defaults",
  },
];
