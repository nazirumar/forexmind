import { MessageSquare } from "lucide-react";
import { Placeholder } from "@/components/layout/placeholder";

export const metadata = { title: "AI Chat - ForexMind" };

export default function ChatPage() {
  return (
    <Placeholder
      title="AI Chat"
      description="Ask forex education and risk-management questions. Streaming replies, markdown rendering, example prompts."
      icon={<MessageSquare className="h-5 w-5" />}
      phase="Phase 2"
    />
  );
}
