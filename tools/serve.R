# Local static server for development (http://localhost:8080).
# Usage: Rscript tools/serve.R [port] [root]   (root defaults to the current folder)
library(httpuv)
args <- commandArgs(TRUE)
port <- if (length(args) >= 1) as.integer(args[1]) else 8080L
root <- normalizePath(if (length(args) >= 2) args[2] else getwd())

srv <- startServer("127.0.0.1", port, list(
  call = function(req) list(status = 404L, headers = list("Content-Type" = "text/plain"), body = "Not found"),
  staticPaths = list("/" = staticPath(root, indexhtml = TRUE, fallthrough = FALSE)),
  staticPathOptions = staticPathOptions(headers = list("Cache-Control" = "no-cache"))
))
cat(sprintf("Serving %s at http://localhost:%d\n", root, port))
on.exit(stopServer(srv))
while (TRUE) service(100)
