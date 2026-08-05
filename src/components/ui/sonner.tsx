import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"

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
            "group toast group-[.toaster]:bg-[#31D880] group-[.toaster]:text-white group-[.toaster]:border-none group-[.toaster]:shadow-lg group-[.toaster]:rounded-2xl",
          description: "group-[.toast]:text-white/80",
          actionButton:
            "group-[.toast]:bg-white group-[.toast]:text-[#31D880]",
          cancelButton:
            "group-[.toast]:bg-white/20 group-[.toast]:text-white",
          error: "group-[.toaster]:bg-[#EA4335] group-[.toaster]:text-white",
          success: "group-[.toaster]:bg-[#31D880] group-[.toaster]:text-white",
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
