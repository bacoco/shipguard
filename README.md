# e2e-agent-browser

**agent-browser runs commands. This plugin builds and maintains your entire test suite.**

## agent-browser alone vs. with this plugin

| | agent-browser seul | agent-browser + e2e-agent-browser |
|---|---|---|
| **Decouverte des routes** | Vous naviguez manuellement | Le plugin scanne votre code et decouvre toutes les routes, formulaires et features automatiquement |
| **Creation des tests** | Vous ecrivez chaque commande a la main | Les tests sont generes automatiquement a partir du code, ou a partir d'une phrase en langage naturel |
| **Memoire** | Aucune — chaque session repart de zero | Tous les tests sont sauvegardes en YAML, accumules, et rejoues a chaque run |
| **Regressions** | Vous oubliez ce qui a casse avant | Les tests qui ont echoue sont rejoues en priorite, retires apres 3 passes consecutives |
| **Maintenance** | Un bouton renomme = test casse a la main | Le plugin detecte les changements d'UI et met a jour les selecteurs automatiquement |
| **Screenshots** | Vous les regardez (ou pas) | Chaque screenshot est lu et analyse — toute erreur visible = FAIL immediat |
| **Couverture** | Vous testez ce que vous pensez a tester | Le plugin maintient un catalogue exhaustif qui grandit avec votre app |

**En resume : agent-browser est un outil. Ce plugin en fait un systeme de backtesting complet.**

---

## Ce que ca change concretement

### 1. Un catalogue de tests qui se construit tout seul

```bash
/e2e-discover
```

Le plugin lit votre code (routes, navigation, composants, feature flags) et genere un test par page/fonctionnalite. Votre app a 30 pages ? Vous avez 30 tests. Une nouvelle page est ajoutee ? Le prochain discover la detecte et cree le test.

```
e2e-tests/
  auth/login.yaml
  dashboard/home.yaml
  dashboard/file-hub.yaml
  chat/upload-pdf.yaml
  chat/ask-question.yaml
  chat/entity-graph.yaml
  settings/profile.yaml
  ...
```

Vous n'ecrivez rien. Le catalogue existe.

### 2. Du backtesting a chaque changement

```bash
/e2e-run
```

Tous les tests sont rejoues. Ceux qui ont casse recemment passent en premier. Le rapport vous dit exactement ce qui marche et ce qui ne marche pas. A chaque deploy, a chaque merge, a chaque hotfix.

### 3. Des tests qui se reparent tout seuls

Vous renommez un bouton "Envoyer" en "Soumettre". Avec agent-browser seul, votre test casse et vous devez le reecrire. Avec ce plugin :

1. Le test detecte que "Envoyer" n'existe plus → status `STALE`
2. Le plugin fait un snapshot, trouve "Soumettre" a la place
3. Met a jour le manifest automatiquement
4. Re-execute → **PASS**

### 4. Du langage naturel au lieu de commandes

Vous ne dites plus "click e4, fill e16, press Enter". Vous dites :

```bash
/e2e-run j'ai modifie le formulaire d'upload, verifie que ca marche
```

Le plugin comprend l'intent, trouve les tests concernes (via git diff + matching semantique), les execute, et genere les tests manquants si besoin.

### 5. Zero tolerance sur les erreurs visuelles

Avec agent-browser seul, le LLM prend un screenshot et continue sans le regarder — meme si l'ecran affiche une erreur. Avec ce plugin, **chaque screenshot est lu et inspecte**. Un modal d'erreur visible ? FAIL. Un ecran blanc ? FAIL. Un spinner qui tourne encore ? FAIL. Pas de "partial pass", pas de "on verra plus tard".

---

## Exemples

### Apres un refactoring

```bash
/e2e-run j'ai refactore le sidebar de Harmonia
```

→ git diff → fichiers modifies dans `sidebar/` → trouve 3 tests concernes → les execute → les 11 modules sont toujours la → **PASS**

### Apres avoir ajoute une feature

```bash
/e2e-run j'ai ajoute un widget de veille juridique dans le chat
```

→ Aucun test existant pour ce widget → lit le composant → **genere un nouveau test** (ouvrir le panel, verifier les 3 onglets, verifier le rafraichissement) → l'execute → le sauvegarde dans le catalogue → **PASS**

### Avant un deploy

```bash
/e2e-run
```

→ 25 tests executes → regressions d'abord → screenshots valides un par un → rapport :

```
E2E complete: 24/25 passed, 1 failed
Failure: chat/entity-graph.yaml — 0 entites extraites au lieu de 5
Screenshot: _results/screenshots/entity-graph-fail.png
```

### Verification rapide des regressions

```bash
/e2e-run --regressions
```

→ Seulement les 3 tests qui ont casse la derniere fois → 2 passent maintenant → 1 encore en echec → rapport en 30 secondes

### Upload et pipeline complet

```bash
/e2e-run teste l'upload d'un acte de vente et verifie que le pipeline extrait les bonnes entites
```

→ Upload un vrai PDF notarial → attend que l'OCR, l'extraction d'entites, l'indexation RAPTOR terminent → verifie que vendeur, acquereur, notaire, prix sont extraits → pose une question sur le document → verifie que la reponse cite des infos du PDF → **PASS**

---

## Comment ca marche

### Deux skills

| Skill | Quand | Quoi |
|-------|-------|------|
| `/e2e-discover` | Au setup + apres changements structurels | Scanne le code, genere le catalogue de tests |
| `/e2e-run` | A chaque changement | Execute, repare, genere, rapporte |

### Execution hybride

| Action | Execution | Exemple |
|--------|-----------|---------|
| Login, navigation, clics, formulaires | **Directe** (agent-browser) | Rapide, deterministe |
| Attendre un pipeline async | **Hybride** (LLM poll toutes les 3s) | Interprete les indicateurs de progression |
| "La reponse est-elle pertinente ?" | **LLM** | Comprend le contenu |
| Chaque screenshot | **LLM lit l'image** | Detecte les erreurs visuelles |

### Format des tests

YAML lisible, editable, auto-genere :

```yaml
name: "Upload PDF et pipeline"
priority: high
requires_auth: true
timeout: 120s

data:
  pdf_file: "data-sample/contract.pdf"
  expected_entities: [vendeur, acquereur, notaire, prix]

steps:
  - action: open
    url: "{base_url}/chat"

  - action: click
    target: "Nouvelle conversation"

  - action: upload
    target: "file-input"
    file: "{data.pdf_file}"

  - action: llm-wait
    timeout: 90s
    checkpoints:
      - "OCR termine"
      - "Entites detectees"
      - "Indexation terminee"

  - action: llm-check
    criteria: "Entites incluent : {data.expected_entities}"
    severity: critical
    screenshot: entities.png
```

Les selecteurs utilisent le **texte visible** ("Nouvelle conversation"), pas des selecteurs CSS ou des refs DOM qui cassent a chaque render.

---

## Installation

### 1. Prerequis

```bash
npm install -g agent-browser
agent-browser install --with-deps
```

### 2. Installer le plugin

```bash
/plugin marketplace add bacoco/e2e-agent-browser
/plugin install e2e-agent-browser@e2e-agent-browser
```

`/e2e-discover` et `/e2e-run` sont prets.

---

## Frameworks supportes

Next.js, React, Vue, Angular, et tout framework web avec des routes detectables. Le discover utilise des heuristiques adaptatives — s'il ne trouve pas les routes automatiquement, il demande.

---

## License

MIT
