import "./globals.css";
import Link from "next/link";
export const metadata={title:"Rozark",description:"AI-native technical assessment platform"};
export default function RootLayout({children}:{children:React.ReactNode}){ return <html lang="en"><body><header className="border-b border-gray-800 p-4 flex gap-6"><Link href="/" className="font-bold text-xl">Rozark</Link><Link href="/challenges" className="text-gray-300">Challenges</Link><Link href="/challenges/new" className="text-gray-300">Create Challenge</Link></header><main className="mx-auto max-w-5xl p-6">{children}</main></body></html>; }
