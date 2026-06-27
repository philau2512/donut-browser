import { Geist, Geist_Mono } from "next/font/google";
import "@/styles/globals.css";
import "@xyflow/react/dist/style.css";
import "flag-icons/css/flag-icons.min.css";
import { ClientProviders } from "@/components/app-shell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased overflow-hidden bg-background`}
      >
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
