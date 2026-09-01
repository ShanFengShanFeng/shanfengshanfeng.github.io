(function () {
  "use strict";

  var container = document.getElementById("scholar-publications");
  if (!container) return;

  var source = container.getAttribute("data-source");
  var profileUrl = container.getAttribute("data-profile");
  var updatedLabel = document.getElementById("scholar-updated");
  var manualPublications = document.getElementById("manual-publications");

  function textElement(tagName, className, value) {
    var element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = value || "";
    return element;
  }

  function publicationLink(publication) {
    var link = publication.scholar_url;
    if (typeof link === "string" && /^https:\/\/scholar\.google\./.test(link)) {
      return link;
    }
    return profileUrl;
  }

  function normalizePublications(data) {
    var raw = data && data.publications;
    if (!raw) return [];

    var publications = Array.isArray(raw) ? raw : Object.keys(raw).map(function (key) {
      return raw[key];
    });

    return publications.map(function (publication) {
      var bib = publication.bib || {};
      return {
        title: publication.title || bib.title || "Untitled publication",
        authors: publication.authors || bib.author || "",
        venue: publication.venue || bib.citation || bib.journal || "",
        year: String(publication.year || bib.pub_year || ""),
        citations: Number(publication.citations != null ? publication.citations : publication.num_citations) || 0,
        scholar_url: publication.scholar_url || ""
      };
    }).sort(function (a, b) {
      var yearDifference = (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0);
      return yearDifference || a.title.localeCompare(b.title);
    });
  }

  function renderPublication(publication) {
    var item = document.createElement("article");
    item.className = "publication-item";

    var heading = document.createElement("h3");
    var titleLink = document.createElement("a");
    titleLink.href = publicationLink(publication);
    titleLink.textContent = publication.title;
    titleLink.target = "_blank";
    titleLink.rel = "noopener noreferrer";
    heading.appendChild(titleLink);
    item.appendChild(heading);

    if (publication.authors) {
      item.appendChild(textElement("p", "publication-authors", publication.authors));
    }
    if (publication.venue) {
      item.appendChild(textElement("p", "publication-venue", publication.venue));
    }

    var metadata = document.createElement("p");
    metadata.className = "publication-meta";
    if (publication.year) {
      metadata.appendChild(textElement("span", "publication-year", publication.year));
    }

    var citationLink = document.createElement("a");
    citationLink.href = publicationLink(publication);
    citationLink.target = "_blank";
    citationLink.rel = "noopener noreferrer";
    citationLink.textContent = publication.citations + (publication.citations === 1 ? " citation" : " citations");
    metadata.appendChild(citationLink);
    item.appendChild(metadata);

    return item;
  }

  fetch(source + "?v=" + Date.now(), { cache: "no-store" })
    .then(function (response) {
      if (!response.ok) throw new Error("Scholar data request failed");
      return response.json();
    })
    .then(function (data) {
      var publications = normalizePublications(data);
      if (!publications.length) throw new Error("Scholar data contained no publications");

      var fragment = document.createDocumentFragment();
      publications.forEach(function (publication) {
        fragment.appendChild(renderPublication(publication));
      });
      container.textContent = "";
      container.appendChild(fragment);

      var totalCitation = document.getElementById("total_cit");
      if (totalCitation && data.citedby != null) totalCitation.textContent = data.citedby;

      if (updatedLabel && data.updated_at) {
        var updated = new Date(data.updated_at);
        if (!isNaN(updated.getTime())) {
          updatedLabel.textContent = " Last updated " + updated.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric"
          }) + ".";
        }
      }
    })
    .catch(function () {
      container.textContent = "";
      var error = textElement("p", "publication-error", "The synchronized publication list is temporarily unavailable.");
      var profile = document.createElement("a");
      profile.href = profileUrl;
      profile.target = "_blank";
      profile.rel = "noopener noreferrer";
      profile.textContent = "View all publications on Google Scholar";
      error.appendChild(document.createTextNode(" "));
      error.appendChild(profile);
      error.appendChild(document.createTextNode("."));
      container.appendChild(error);
      if (manualPublications) manualPublications.hidden = false;
    });
})();
