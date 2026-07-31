import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CookSpec",
  description:
    "Paste a link to a TikTok, Reel, Short, or article and get the recipe back as one engineering table.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
