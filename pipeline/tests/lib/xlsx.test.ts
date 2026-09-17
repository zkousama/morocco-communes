import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { readSheetRows } from "../../src/lib/xlsx.ts";

function buildWorkbook(): Uint8Array {
  const sharedStrings = `<?xml version="1.0"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
  <si><t>Commune de Tanger</t></si><si><t>طنجة</t></si><si><t>Cercle de Tanger</t></si>
  <si><r><t xml:space="preserve">Préfecture d'Arrondissements </t></r><r><t>Ben M'sick</t></r></si>
</sst>`;
  const sheet = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1268512</v></c><c r="F1" t="s"><v>1</v></c><c r="G1"><v>1511010</v></c></row>
  <row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>001511</v></c><c r="D2" t="s"><v>3</v></c><c r="G2"><v>151105</v></c></row>
</sheetData></worksheet>`;
  const workbook = `<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheets><sheet name="Population_légale" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  return zipSync({
    "xl/workbook.xml": strToU8(workbook),
    "xl/sharedStrings.xml": strToU8(sharedStrings),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  });
}

describe("readSheetRows", () => {
  const rows = readSheetRows(buildWorkbook());

  it("resolves shared strings", () => {
    expect(rows[0]?.[0]).toBe("Commune de Tanger");
    expect(rows[0]?.[5]).toBe("طنجة");
  });

  it("keeps inline numbers as strings so leading zeros are never invented", () => {
    expect(rows[0]?.[1]).toBe("1268512");
    expect(rows[0]?.[6]).toBe("1511010");
  });

  it("positions cells by column letter so gaps do not shift the row", () => {
    expect(rows[1]?.[0]).toBe("Cercle de Tanger");
    expect(rows[1]?.[1]).toBeNull();
    expect(rows[1]?.[6]).toBe("151105");
  });

  it("keeps a leading zero that number coercion would eat", () => {
    expect(rows[1]?.[2]).toBe("001511");
  });

  it("joins rich-text runs and keeps the space they preserve between them", () => {
    expect(rows[1]?.[3]).toBe("Préfecture d'Arrondissements Ben M'sick");
  });
});
