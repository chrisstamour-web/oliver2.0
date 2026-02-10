// app/components/MainHeader.tsx
import Image from "next/image";
import { Montserrat } from "next/font/google";

const BRAND = "#49257a";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export default function MainHeader() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 0 14px",
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid #eee",
          background: "#fff",
          flex: "0 0 auto",
        }}
      >
        <Image src="/logo.png" alt="Oliver" width={38} height={38} priority />
      </div>

      <div style={{ lineHeight: 1.05 }}>
        <div style={{ fontWeight: 900, color: BRAND, fontSize: 18 }}>Oliver</div>

        <div
          className={montserrat.className}
          style={{
            fontSize: 13,
            color: "#4b5563", // softer than #111 (optional but nicer)
            marginTop: 3,
            fontWeight: 500,
          }}
        >
          your Pathova Assistant
        </div>
      </div>
    </div>
  );
}
