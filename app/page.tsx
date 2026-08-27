import AppShell from "@/components/AppShell";
import { itemIndexMeta } from "@/lib/resolver";

export default function Home() {
  return <AppShell itemNames={itemIndexMeta.names} generatedAt={itemIndexMeta.generatedAt} />;
}
