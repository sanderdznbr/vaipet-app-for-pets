import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"
import { AlertCircle, CheckCircle2 } from "lucide-react"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-[#31D880] group-[.toaster]:text-white group-[.toaster]:border-none group-[.toaster]:shadow-lg group-[.toaster]:rounded-2xl group-[.toaster]:px-4 group-[.toaster]:py-3 group-[.toaster]:flex group-[.toaster]:items-center group-[.toaster]:gap-3",
          description: "group-[.toast]:text-white/80",
          actionButton:
            "group-[.toast]:bg-white group-[.toast]:text-[#31D880]",
          cancelButton:
            "group-[.toast]:bg-white/20 group-[.toast]:text-white",
          error: "group-[.toaster]:bg-[#EA4335] group-[.toaster]:text-white",
          success: "group-[.toaster]:bg-[#31D880] group-[.toaster]:text-white",
        },
      }}
      icons={{
        error: <AlertCircle className="h-5 w-5" />,
        success: <CheckCircle2 className="h-5 w-5" />,
      }}
      {...props}
    />
  )
}

export { Toaster, toast }

