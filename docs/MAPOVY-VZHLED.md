# Skutečná mapa s herním a pixelovým vzhledem

30. října 2026

## Doporučení

Použít skutečná vektorová data OSM přes OpenFreeMap, vykreslit je v MapLibre a navrhnout vlastní styl. Zachovat skutečné ulice, parky, vodu a půdorysy budov; přidat výrazné pixelové postavy, truhly a předměty. To je proveditelná cesta blízká novým obrázkům. Celé ručně vypadající pixelové město ze starších konceptů je náročnější cíl.

„Cargo“ v zadání pravděpodobně znamená CARTO. CARTO je poskytovatel mapových služeb a stylů. OpenStreetMap je zdroj geografických dat. MapLibre je knihovna, která je vykresluje. Styl určuje, jak vykreslení vypadá; hra přidává vlastní objekty a pravidla.

## Co lze změnit přímo stylem

| Vzhled | Provedení | Náročnost |
| --- | --- | --- |
| Mintové parky, tyrkysová voda, fialové budovy | Barvy samostatných vektorových vrstev | Nízká |
| Širší, čitelnější cesty | Šířka podle třídy cesty a přiblížení | Nízká |
| Méně nápisů a POI | Filtry vrstev, vlastní písmo a ikony | Nízká |
| Jednoduché plastické budovy | Výškově vysunuté skutečné půdorysy | Nízká až střední |
| Pixelová tráva/voda | Opakovaná textura ve výplni polygonů | Střední; doladit měřítko a pohyb při zoomu |
| Pixelová postava a předměty | Sprite atlas nebo optimalizované GLB | Střední |
| Pixelový vzhled celého vykreslení | Mapa do menšího render targetu a zvětšení bez vyhlazení; UI a popisky samostatně | Vyšší, zejména integrace s mobilním GPU a globusem |
| Fasády, střechy, konkrétní stromy a voxelové domy | Vlastní generátor 3D scény a katalog assetů | Výrazně vyšší; běžný mapový styl to nevytvoří |

MapLibre podporuje barvy, vzory výplní, šířky cest, symboly a extruze. Nearest-neighbor resampling existuje pro rastrové vrstvy, ale není univerzálním přepínačem všech vektorových budov na pixel art. Samotné CSS `image-rendering: pixelated` na plně ostrém WebGL canvasu také nevytvoří novou výtvarnou scénu. [Specifikace stylů](https://maplibre.org/maplibre-style-spec/layers/).

Pro plnou pixelizaci bychom mapu vykreslovali do samostatné menší textury a tu zobrazovali bez interpolace. Text, tlačítka a důležité navigační údaje by zůstaly ostré. Je nutné sladit polohu značek a hit-testy, zabránit blikání při pohybu a otestovat náklady dalšího renderování. Proto tuto techniku nezařazujeme do prvního herního řezu jako nutnou podmínku.

## Co ukazuje skutečný pokus

[Místní mapová studie](../output/map-style-study/index.html) načítá centrum Plzně z OpenFreeMap a vykresluje ho pomocí MapLibre GL JS 5.6.1. Obsahuje přepínač běžného podkladu, herního stylu a textury a ovladač přiblížení z globusu do města.

U herního stylu byly v prohlížeči ověřeny skutečné půdorysy, změna barev, širší cesty, nízké extruze, avatar a zóna. [Neupravovaný screenshot vykreslení](../output/concepts/map-style-verified.png) je důkazem této úrovně proveditelnosti; funguje také [zobrazení globusu](../output/concepts/globe-verified.png). Interakce a rychlost na fyzickém iPhonu zatím ověřené nejsou. Výšky v této studii jsou pro čitelnost omezené; nejde o přesnou stavební dokumentaci.

Studie má pouze ilustrační herní značky, žádné napojené peněženky ani odměny. Není navigační aplikací a umístění značky není ověření veřejné přístupnosti. Produkční generování předmětů musí používat přístupné plochy a skutečné GPS podmínky.

Nové mobilní a desktopové obrázky vznikly vestavěným imagegen z tohoto screenshotu. Zachovávají rozpoznatelný základ lokality, ale generátor může upravit detaily mapy, popisky i polohu předmětů. Nejsou podkladem pro výpočet vzdáleností. V první mobilní variantě zůstal také dekorativní kulatý marker, který není navrženou herní mechanikou. Implementace použije data, nikoli překreslený obrázek.

## Výběr podkladu

**OpenFreeMap** doporučuji pro první implementaci. Nabízí OSM vektorové dlaždice, výchozí styly a možnost úprav v Maputniku; veřejná služba podle aktuálního popisu nevyžaduje klíč ani registraci. Vlastní styl hostujeme sami. Pro produkci vyhodnotíme dostupnost služby, offline pravidla a možnost vlastního provozu. [Služba](https://openfreemap.org/), [návod](https://openfreemap.org/quick_start/).

**CARTO** je použitelná alternativa. Aktuální dokumentace uvádí vlastní styly nad vektorovou sadou v2 s jiným schématem než starší v1. Raster od 25. září 2026 vyžaduje klíč; vektory podle stejné dokumentace zatím fungují i bez něj, ale poskytovatel doporučuje klíč používat. Komerční bezplatná úroveň je aktuálně do 1 milionu požadavků za kalendářní měsíc; při růstu je třeba počítat s plánem. Vektorový zdroj proto nelze jen zaměnit pod libovolným cizím stylem bez kontroly názvů vrstev. [Aktuální CARTO FAQ](https://docs.carto.com/faqs/carto-basemaps).

**Běžné rastrové OSM dlaždice** jsou už hotové obrázky. Filtr může změnit jejich celkovou barvu, ale ne spolehlivě oddělit silnici, park a text. Pro toto přeskinování je správná vektorová cesta. Veřejný OSM tile server není automaticky neomezený herní CDN ani offline archiv. [Pravidla serveru dlaždic](https://operations.osmfoundation.org/policies/tiles/).

Attribution dat i poskytovatele ponecháme podle podmínek na mapě. Vlastní vzhled nebo absence značky původní aplikace neznamená odstranění licencí OSM či mapových assetů.

## Vizuální pravidla pro další iteraci

- Mapu držet pastelovou a klidnou; vyšší kontrast dát postavě, aktivním úkolům a odměnám.
- Budovy snižovat nebo zprůhledňovat kolem hráče, aby nezakrývaly chodník a nároky.
- Dekorativní stromy jsou možná další vrstva, ale běžná data OSM nezaručují polohu každého stromu.
- Silnice mohou být opticky širší; podmínky sbírání zůstávají v reálných metrech.
- Popisky přímo využívat z dat, s vhodnou lokalizací. Chybné nebo nechtěné názvy z generovaných obrázků se nepřenášejí.
- Nejprve optimalizovat počet modelů, materiálů a transparentních vrstev. Finální rozpočet určit na skutečném telefonu, nikoli odhadem podle desktopového screenshotu.
