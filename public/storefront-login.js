// Older email links used the public home. Keep their fragment secret while opening the login screen.
if (new URLSearchParams(location.hash.slice(1)).has("email-login")) {
  const url = new URL(location.href);
  url.pathname = document.getElementById("root").dataset.shopBase || "/";
  url.searchParams.set("pane", "mine");
  location.replace(url.href);
}
