import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CD Import Tracker | Gestão de Importações & Rateio',
  description:
    'Aplicativo SPA para documentar a compra de CDs no exterior (eBay), redirecionadores, consolidação de pacotes e cálculo automático de custo real em BRL.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased selection:bg-indigo-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
