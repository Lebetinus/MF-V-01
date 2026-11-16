"use client";

import { useState } from "react";
import { tx, localizeData } from "../../lib/i18n";
import type { Language } from "../../lib/types";

// "Filtrele" panelinin durumu (tarih aralığı, ana başlık, kişi, proje, etiket).
export function useRecordFilters() {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterPerson, setFilterPerson] = useState("");
  const [filterProject, setFilterProject] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const activeFilterCount = [filterFrom, filterTo, filterSource, filterPerson, filterProject, filterTag].filter(Boolean).length;
  const clearFilters = () => {
    setFilterFrom("");
    setFilterTo("");
    setFilterSource("");
    setFilterPerson("");
    setFilterProject("");
    setFilterTag("");
  };

  return {
    filtersOpen,
    setFiltersOpen,
    filterFrom,
    setFilterFrom,
    filterTo,
    setFilterTo,
    filterSource,
    setFilterSource,
    filterPerson,
    setFilterPerson,
    filterProject,
    setFilterProject,
    filterTag,
    setFilterTag,
    activeFilterCount,
    clearFilters,
  };
}

export type RecordFilters = ReturnType<typeof useRecordFilters>;

export function renderFilterPanel(filters: RecordFilters, filterSourceOptions: string[], language: Language) {
  const {
    filterFrom,
    setFilterFrom,
    filterTo,
    setFilterTo,
    filterSource,
    setFilterSource,
    filterPerson,
    setFilterPerson,
    filterProject,
    setFilterProject,
    filterTag,
    setFilterTag,
    activeFilterCount,
    clearFilters,
  } = filters;
  return (
    <div className="filterPanel">
      <label>
        {tx(language, "Başlangıç Tarihi", "From Date", "Ji Tarîxê")}
        <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
      </label>
      <label>
        {tx(language, "Bitiş Tarihi", "To Date", "Heta Tarîxê")}
        <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
      </label>
      <label>
        {tx(language, "Ana Başlık", "Main Category", "Sernavê Sereke")}
        <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)}>
          <option value="">{tx(language, "Tümü", "All", "Hemû")}</option>
          {filterSourceOptions.map((name) => (
            <option key={name} value={name}>
              {localizeData(name, language)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {tx(language, "Kişi", "Person", "Kes")}
        <input value={filterPerson} onChange={(e) => setFilterPerson(e.target.value)} />
      </label>
      <label>
        {tx(language, "Proje / Birim", "Project / Unit", "Proje / Yekîne")}
        <input value={filterProject} onChange={(e) => setFilterProject(e.target.value)} />
      </label>
      <label>
        {tx(language, "Etiket", "Tag", "Etîket")}
        <input value={filterTag} onChange={(e) => setFilterTag(e.target.value)} />
      </label>
      <button type="button" className="light" onClick={clearFilters} disabled={!activeFilterCount}>
        {tx(language, "Filtreleri Temizle", "Clear Filters", "Parzûnan Paqij Bike")}
      </button>
    </div>
  );
}
