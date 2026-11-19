# Generates the PWA icons (dark theme) into ../icons.
# Usage (from the repo root): Rscript tools/make_icons.R
out <- file.path(getwd(), "icons")
dir.create(out, showWarnings = FALSE)

bg <- "#0f1218"; card <- "#1b2130"; card2 <- "#26304a"; accent <- "#5b9cff"; text <- "#e8edf7"

draw_icon <- function(file, size, pad = 0) {
  png(file, width = size, height = size, bg = bg, type = "cairo")
  op <- par(mar = c(0, 0, 0, 0)); on.exit({ par(op); dev.off() })
  plot.new(); plot.window(c(0, 1), c(0, 1), xaxs = "i", yaxs = "i")
  s <- 1 - 2 * pad                      # usable area (maskable keeps a safe zone)
  m <- function(v) pad + v * s
  # back card (tilted look via offset) and front card
  rect(m(0.24), m(0.20), m(0.84), m(0.74), col = card2, border = NA)
  rect(m(0.16), m(0.27), m(0.76), m(0.81), col = card, border = accent, lwd = size / 64)
  text(m(0.46), m(0.56), "IB", col = text, font = 2, cex = size / 46 * s)
  rect(m(0.27), m(0.36), m(0.65), m(0.39), col = accent, border = NA)
}

draw_icon(file.path(out, "icon-192.png"), 192)
draw_icon(file.path(out, "icon-512.png"), 512)
draw_icon(file.path(out, "icon-maskable-512.png"), 512, pad = 0.10)
draw_icon(file.path(out, "apple-touch-icon.png"), 180)
cat("icons written to", out, "\n")
