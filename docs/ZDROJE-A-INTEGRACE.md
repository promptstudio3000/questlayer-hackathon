# Zdroje a plánované integrace

Přípravný registr k 30. říjnu 2026. Aktuální chování navrhované hry určuje [celkový plán](../PLAN-HRY.md). Odkazy níže dokládají technické možnosti a podmínky externích komponent; samy nepotvrzují jejich nasazení v této hře. Prahy tierů, podíl výnosu 0–100 %, soutěžní pravidla a provozní odhad výběru 1–7 dní jsou pravidla našeho návrhu, nikoli nabídka nebo garance NEAR protokolu.

## Účty a testování

| Zdroj | Použití a omezení |
| --- | --- |
| [NEAR Connect Passkey](https://github.com/NEAR-DevHub/near-connect-passkey) | Passkey konektor; současný manifest deklaruje mainnet, nikoli testnet. Vlastní testnetové zapojení je součást vývoje. |
| [WebAuthn wallet kontrakt](https://github.com/near/intents/blob/main/contracts/wallet/README.md) | Podpisy, rozšíření a obnova. README označuje implementaci jako neauditovanou; neprezentovat jako prověřenou mainnetovou peněženku. |
| [Ethereum wallets konektor](https://github.com/near/wallet-selector/blob/main/packages/ethereum-wallets/README.md) | Alternativní EVM podpisy pro nativní NEAR; respektovat omezení EOA, akcí a podporovaných funkcí. |
| [NEAR Kit sandbox](https://kit.near.tools/dapp-workflow/testing) | Lokální uzel, předfinancované účty, změny stavu, posun bloků a testovací snapshoty. |
| [Testnet faucet](https://near-faucet.io/) | Získání testovacích prostředků. Výši přídělu ověřit, neopírat postup o pevně slíbených 10 NEAR. |
| [RPC poskytovatelé](https://docs.near.org/api/rpc/providers) | Konfigurovatelné endpointy, fallback a limity. Veřejný endpoint není určen k neomezenému zátěžovému testu. |

Server hry nebude držet hráčské soukromé klíče ani seed zálohy. Passkey a seed nejsou zaměnitelné. Provozní podpis relayeru je oddělený od oprávnění hráče.

## Staking a výnosové strategie

| Zdroj | Použití a omezení |
| --- | --- |
| [Nativní staking](https://docs.near.org/protocol/tutorials/staking-tokens) | Vklady, čtení pozic, unstake a výběry; dokumentace uvádí uvolnění po čtyřech epochách. |
| [Referenční staking pool](https://github.com/near/core-contracts/blob/master/staking-pool/src/lib.rs) | Dostupnost nestakovaného zůstatku se vztahuje k účtu v poolu. Nový unstake může odsunout výběr; dávky se nesmějí průběžně resetovat. |
| [Meta Pool kontrakty](https://docs.metapool.app/master/for-developers/meta-pool-contracts/near-network) | Metody hodnoty stNEAR a stavu likvidity, uvedené mainnet/testnet adresy. Před použitím ověřit skutečné nasazení. |
| [Meta Pool výběry](https://docs.metapool.app/master/meta-pool-ecosystem/stake/fast-unstake) | Rychlý výběr je podmíněn likviditou a poplatkem; není totožný s nativním unstakingem. |
| [Rhea supplying](https://guide.rhea.finance/near-chain-guides/lending-and-borrowing/supplying) | Půjčovací trh, proměnlivý úrok a likviditní omezení výběru. |
| [Rhea audity](https://guide.rhea.finance/developers/audits) | Audity mají konkrétní rozsah a verzi; nejsou univerzální zárukou protokolu. |

Pro první verzi funguje volba povolených validačních poolů. Meta Pool a Rhea jsou další strategie v přehledu. Nativní stakingový výnos je už v NEAR, není třeba jej směňovat. Do treasury vstupuje až likvidní potvrzený příjem.

## Tržiště, profily a obsah

| Zdroj | Použití a omezení |
| --- | --- |
| [NEAR Intents Verifier](https://github.com/near/intents) | Otevřený kontrakt pro přímé vypořádání; vlastní testnetová instance není oficiálním testnetem celého ekosystému. |
| [NEP-171 vklady](https://github.com/near/intents/blob/main/contracts/defuse/src/contract/tokens/nep171/deposit.rs) | Příjem NFT do interního zůstatku Verifieru. |
| [NEP-171 výběry](https://github.com/near/intents/blob/main/contracts/defuse/src/tokens/nep171.rs) | Asynchronní návrat NFT z Verifieru. |
| [TokenDiff](https://github.com/near/intents/blob/main/contracts/defuse/core/src/intents/token_diff.rs) | Vypořádání změn tokenů; podpora NFT není totéž co hotové tržiště nebo zajištěná likvidita. |
| [1Click](https://docs.near-intents.org/integration/distribution-channels/1click-api/about-1click-api) | Směnné rozhraní; v1 NFT market používá přímo Verifier a vlastní nabídky. |
| [SocialDB](https://github.com/NearSocial/social-db) | Veřejný profil a zprávy, oprávnění zápisu a testnetové nasazení. Smazání aktuální hodnoty nemaže blockchainovou historii. |
| [IPFS pinning](https://docs.ipfs.tech/how-to/pin-files/) | Dostupnost obrázků vyžaduje uchování/pinning; CID sám soubor nehostuje. |
| [NEAR plugins](https://github.com/near/near-plugins) | Stavební bloky řízení rolí, pozastavení a upgradů; práva nastavovat podle konkrétního kontraktu. |
| [NEAR AI Cloud](https://docs.near.ai/cloud) | Návrhy questů a dialogy; API klíče na serveru, bez automatického finančního rozhodování. |

Atomické vypořádání uvnitř Verifieru nezaručuje atomický konec následných externích výběrů. Výplaty i výběry mají trvalé stavy a opakování bez dvojího plnění.

## Aavegotchi a assety

| Zdroj | Použití a omezení |
| --- | --- |
| [Migrace na Base](https://blog.aavegotchi.com/aavegotchi-has-migrated-to-base/) | Originální vlastnictví čteme na Base. |
| [Oficiální adresy](https://github.com/aavegotchi/deployed-contract-addresses/blob/main/README.md) | Před integrací ověřit aktuální kontrakty a ABI; nepřebírat staré Polygon adresy. |
| [3D renderer](https://github.com/aavegotchi/aavegotchi-3d-render-skill/blob/main/SKILL.md) | Dokumentované výstupy PNG/GLB a odvození vzhledu. Dostupnost, CORS a modularita vyžadují ověření. |
| [Unity SDK](https://github.com/aavegotchi/unity-sdk) | Katalog modelů a wearables; Unity materiály/prefaby nejsou automaticky kompatibilní s webovým rendererem. |
| [Base licence](https://github.com/aavegotchi/aavegotchi-base/blob/master/LICENSE) | MIT pro uvedený kód, nikoli automaticky všechna grafika. |
| [Generátor spritů](https://github.com/aavegotchi/aavegotchi-game-sprites/blob/master/README.md) | Zvláštní rozlišení práv k assetům a ochranným známkám. |
| [Oznámení o IP](https://blog.aavegotchi.com/aavegotchi-beyond-the-one-studio-model/) | Návrhy otevření IP samy nepotvrzují účinné plošné CC0 pro celý katalog. |

Každý veřejně distribuovaný asset musí mít evidovaný zdroj, konkrétní právo použití a povinnou atribuci. Načítání modelu z cizího hostingu tuto otázku neobchází. Přednostně načítáme potřebné GLB na vyžádání; vlastní optimalizace a hosting slouží tam, kde je nutná modularita, výkon nebo dostupnost.

## Mapy a hackathon

- [MapLibre projekce](https://maplibre.org/maplibre-style-spec/projection/) a [vrstvy](https://maplibre.org/maplibre-style-spec/layers/): globe/flat přechod, vzhled cest a ploch.
- [OpenFreeMap](https://openfreemap.org/quick_start/) a [OSM atribuce](https://www.openstreetmap.org/copyright): mapový podklad a povinné označení.
- [CARTO basemaps](https://docs.carto.com/faqs/carto-basemaps): alternativní poskytovatel s vlastními podmínkami a režimem API klíčů.
- [Games track](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/09-games.md) a [hackathon](https://nearhackathon.com/): aktuální soutěžní podmínky ověřit před publikací.

Nová implementace je plánovaná nejdříve od 1. listopadu 2026 00:00 UTC (01:00 Europe/Prague). Přípravné dokumenty, vizuály a prototypy si zachovávají skutečné datum vzniku. Skutečně použité externí komponenty zachovají licence a informace požadované soutěží; nebudeme vydávat starší soubor za nově vzniklý změnou jeho data.
