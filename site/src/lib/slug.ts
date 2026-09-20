/**
 * The slug a page is published under, from its French name. Shared by the build, which
 * writes the pages, and by the search in the header, which has to guess a province's or
 * a région's URL from the name the API gives back.
 */
export const slugify = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
