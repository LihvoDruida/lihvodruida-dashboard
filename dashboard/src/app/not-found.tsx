import type { Metadata } from "next";
import AppProblemScreen from "@/components/AppProblemScreen";

export const metadata: Metadata = {
  title: "Сторінку не знайдено",
  description: "Ця сторінка гільдійної панелі недоступна або була переміщена.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function NotFound() {
  return (
    <AppProblemScreen
      kind="not-found"
      primaryHref="/"
      primaryLabel="До панелі"
      secondaryHref="/profiles"
      secondaryLabel="До профілів"
      details={[
        "Перевір адресу сторінки.",
        "Якщо це профіль — він міг бути видалений або перенесений.",
        "Дані не змінювались: це лише помилка маршруту.",
      ]}
    />
  );
}
