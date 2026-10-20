(function () {
  "use strict";

  var container = document.getElementById("scholar-publications");
  if (!container) return;

  var manualPublications = document.getElementById("manual-publications");
  var filter = document.getElementById("publication-source-filter");
  var sources = [
    { id: "scholar", name: "Google Scholar", url: container.getAttribute("data-source"), profile: container.getAttribute("data-profile"), totalId: "total_cit", updatedId: "scholar-updated" },
    { id: "cnki", name: "CNKI", url: container.getAttribute("data-cnki-source"), fallback: container.getAttribute("data-cnki-fallback"), profile: container.getAttribute("data-cnki-profile"), totalId: "cnki_total_cit", updatedId: "cnki-updated" }
  ];

  function textElement(tagName, className, value) {
    var element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = value == null ? "" : value;
    return element;
  }

  function safeUrl(value, fallback) {
    return typeof value === "string" && /^https:\/\//i.test(value) ? value : (fallback || "");
  }

  function externalLink(label, url, className) {
    var link = textElement("a", className, label);
    link.href = safeUrl(url);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }

  function citationCount(value) {
    if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
    var number = Number(value);
    return isFinite(number) && number >= 0 && Math.floor(number) === number ? number : null;
  }

  function titleKey(value) {
    var title = String(value || "");
    if (title.normalize) title = title.normalize("NFKC");
    return title.replace(/\s+/g, " ").trim().toLowerCase();
  }

  function doiKey(value) {
    return String(value || "").trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "").toLowerCase();
  }

  function normalizePublications(data, source) {
    var raw = data && data.publications;
    if (!raw || typeof raw !== "object") throw new Error("Missing publications");
    var publications = Array.isArray(raw) ? raw : Object.keys(raw).map(function (key) { return raw[key]; });
    return publications.filter(function (publication) {
      return publication && (publication.title || (publication.bib && publication.bib.title));
    }).map(function (publication) {
      var bib = publication.bib || {};
      var authors = publication.authors || bib.author || "";
      return {
        title: String(publication.title || bib.title),
        authors: Array.isArray(authors) ? authors.join(", ") : String(authors),
        venue: String(publication.venue || bib.citation || bib.journal || ""),
        year: String(publication.year || bib.pub_year || "").trim(),
        doi: doiKey(publication.doi || bib.doi),
        titleAliases: (Array.isArray(publication.title_aliases) ? publication.title_aliases : []).filter(function (title) { return typeof title === "string"; }).map(titleKey),
        citations: citationCount(publication.citations != null ? publication.citations : publication.num_citations),
        url: safeUrl(source.id === "cnki" ? publication.cnki_url : publication.scholar_url, source.profile),
        source: source.id
      };
    });
  }

  function mergedPublications() {
    var aliases = [];
    sources.forEach(function (source) {
      if (source.data && Array.isArray(source.data.publication_aliases)) {
        aliases = aliases.concat(source.data.publication_aliases);
      }
    });
    var groups = [];
    sources.forEach(function (source) {
      (source.publications || []).forEach(function (publication) {
        var keys = ["title:" + titleKey(publication.title)];
        if (publication.doi) keys.push("doi:" + publication.doi);
        aliases.forEach(function (alias, index) {
          if (!alias || !Array.isArray(alias.titles)) return;
          if (alias.titles.some(function (title) { return titleKey(title) === titleKey(publication.title); }) ||
              (publication.doi && doiKey(alias.doi) === publication.doi)) {
            keys.push("alias:" + index);
          }
        });
        var matches = groups.filter(function (group) {
          // DOI and reviewed translations identify a work even when its metadata differs.
          if (keys.some(function (key) { return key.indexOf("title:") !== 0 && group.keys.indexOf(key) !== -1; })) return true;
          if (group.records.some(function (record) {
            return publication.titleAliases.indexOf(titleKey(record.title)) !== -1 ||
              record.titleAliases.indexOf(titleKey(publication.title)) !== -1 ||
              publication.titleAliases.some(function (title) { return record.titleAliases.indexOf(title) !== -1; });
          })) return true;
          // A common title alone is insufficient when known DOI or year values conflict.
          if (group.records.some(function (record) {
            return (publication.doi && record.doi && publication.doi !== record.doi) ||
              (publication.year && record.year && publication.year !== record.year);
          })) return false;
          return group.keys.indexOf("title:" + titleKey(publication.title)) !== -1;
        });
        var group = matches[0] || { keys: [], records: [] };
        if (!matches.length) groups.push(group);
        matches.slice(1).forEach(function (other) {
          group.keys = group.keys.concat(other.keys);
          group.records = group.records.concat(other.records);
          groups.splice(groups.indexOf(other), 1);
        });
        group.keys = group.keys.concat(keys);
        group.records.push(publication);
      });
    });
    return groups.map(function (group) {
      var records = {};
      group.records.forEach(function (publication) {
        var existing = records[publication.source];
        if (!existing) records[publication.source] = publication;
        else {
          ["authors", "venue", "year", "doi"].forEach(function (field) {
            if (!existing[field]) existing[field] = publication[field];
          });
          if (existing.citations == null) existing.citations = publication.citations;
        }
      });
      var primary = records.scholar || records.cnki;
      var alternate = records.cnki || primary;
      return {
        title: primary.title,
        alternateTitle: titleKey(alternate.title) === titleKey(primary.title) ? "" : alternate.title,
        authors: primary.authors || alternate.authors,
        venue: primary.venue || alternate.venue,
        year: primary.year || alternate.year,
        url: primary.url,
        records: records
      };
    }).sort(function (a, b) {
      return ((parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0)) || a.title.localeCompare(b.title);
    });
  }

  function renderPublication(publication) {
    var item = textElement("article", "publication-item");
    var heading = document.createElement("h3");
    heading.appendChild(externalLink(publication.title, publication.url));
    item.appendChild(heading);
    if (publication.alternateTitle) item.appendChild(textElement("p", "publication-alternate-title", publication.alternateTitle));
    if (publication.authors) item.appendChild(textElement("p", "publication-authors", publication.authors));
    if (publication.venue) item.appendChild(textElement("p", "publication-venue", publication.venue));

    var metadata = textElement("p", "publication-meta");
    if (publication.year) metadata.appendChild(textElement("span", "publication-year", publication.year));
    sources.forEach(function (source) {
      var record = publication.records[source.id];
      if (!record) return;
      var label = source.name + " · " + (record.citations == null ? "citations unavailable" : record.citations + (record.citations === 1 ? " citation" : " citations"));
      metadata.appendChild(externalLink(label, record.url, "publication-source publication-source--" + source.id));
    });
    item.appendChild(metadata);
    return item;
  }

  function updateSourceLabel(source) {
    var total = document.getElementById(source.totalId);
    var updated = document.getElementById(source.updatedId);
    var count = source.data ? citationCount(source.data.citedby) : null;
    if (total) total.textContent = source.pending ? "Loading…" : count == null ? "Unavailable" : count.toLocaleString();
    if (!updated) return;
    if (source.pending) updated.textContent = "Loading…";
    else if (source.error) updated.textContent = "Temporarily unavailable";
    else {
      var date = new Date(source.data.updated_at || "");
      updated.textContent = (source.savedSnapshot ? "Saved snapshot · " : "") + (!isNaN(date.getTime()) ? "Last synced " + date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Sync date unavailable");
    }
  }

  function render() {
    var publications = mergedPublications();
    var selectedSource = filter ? filter.value : "all";
    var visible = publications.filter(function (publication) { return selectedSource === "all" || publication.records[selectedSource]; });
    var pending = sources.some(function (source) { return source.pending; });
    container.textContent = "";
    var fragment = document.createDocumentFragment();
    visible.forEach(function (publication) { fragment.appendChild(renderPublication(publication)); });
    if (!visible.length) {
      fragment.appendChild(textElement("p", "publication-loading", pending ? "Loading publications…" : publications.length ? "No publications for this source." : "The synchronized publication list is temporarily unavailable. A recent selection is shown below."));
    }
    sources.forEach(function (source) {
      if (!source.error) return;
      var error = textElement("p", "publication-error", source.name + " synchronization data is temporarily unavailable. ");
      error.appendChild(externalLink("View the " + source.name + " profile", source.profile));
      fragment.appendChild(error);
    });
    container.appendChild(fragment);
    if (manualPublications) manualPublications.hidden = pending || publications.length > 0;
    if (filter) filter.disabled = !publications.length;
  }

  if (filter) filter.addEventListener("change", render);
  function fetchData(source) {
    return new Promise(function (resolve, reject) {
      var controller = typeof AbortController === "undefined" ? null : new AbortController();
      var timeout = setTimeout(function () {
        reject(new Error("Publication data request timed out"));
        if (controller) controller.abort();
      }, 20000);
      var options = { cache: "no-store" };
      if (controller) options.signal = controller.signal;
      fetch(source.url + (source.url.indexOf("?") === -1 ? "?" : "&") + "v=" + Date.now(), options)
        .then(function (response) {
          if (!response.ok) throw new Error("Publication data request failed");
          return response.json();
        }).then(function (data) {
          clearTimeout(timeout);
          resolve(data);
        }, function (error) {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  function loadSource(source, url) {
    if (!url) return Promise.reject(new Error("Missing source URL"));
    return fetchData({ url: url }).then(function (data) {
      source.publications = normalizePublications(data, source);
      source.data = data;
    });
  }

  // Each source settles independently: a failed request must not hide the other list.
  sources.forEach(function (source) { source.pending = true; updateSourceLabel(source); });
  sources.forEach(function (source) {
    Promise.resolve().then(function () {
      return loadSource(source, source.url);
    }).catch(function (error) {
      if (!source.fallback) throw error;
      return loadSource(source, source.fallback).then(function () { source.savedSnapshot = true; });
    }).catch(function () {
      source.error = true;
    }).then(function () {
      source.pending = false;
      updateSourceLabel(source);
      render();
    });
  });
})();
