Prepare all required actions
Getting action download info
Download action repository 'actions/cache@v4' (SHA:3624ceb22c1c5a301c8db4169662070a689d9ea8)
Run ./src/electron/.github/actions/checkout
  with:
    generate-sas-token: false
  env:
    GCLIENT_EXTRA_ARGS: --custom-var=checkout_arm=True --custom-var=checkout_arm64=True
    PATCH_UP_APP_CREDS: ***
Run echo "GIT_CACHE_PATH=$(pwd)/git-cache" >> $GITHUB_ENV
  echo "GIT_CACHE_PATH=$(pwd)/git-cache" >> $GITHUB_ENV
  shell: bash --noprofile --norc -e -o pipefail {0}
  env:
    GCLIENT_EXTRA_ARGS: --custom-var=checkout_arm=True --custom-var=checkout_arm64=True
    PATCH_UP_APP_CREDS: ***
Run cd src/electron
  cd src/electron
  node script/yarn install --frozen-lockfile
  shell: bash --noprofile --norc -e -o pipefail {0}
  env:
    GCLIENT_EXTRA_ARGS: --custom-var=checkout_arm=True --custom-var=checkout_arm64=True
    PATCH_UP_APP_CREDS: ***
    GIT_CACHE_PATH: /__w/electron/electron/git-cache
yarn install v1.15.2
$ node -e 'process.exit(0)'
[1/4] Resolving packages...
[2/4] Fetching packages...
info fsevents@2.3.2: The platform "linux" is incompatible with this module.
info "fsevents@2.3.2" is an optional dependency and failed compatibility check. Excluding it from installation.
[3/4] Linking dependencies...
[4/4] Building fresh packages...
$ husky install
husky - Git hooks installed
Done in 45.82s.
Run git clone --depth=1 https://chromium.googlesource.com/chromium/tools/depot_tools.git
Cloning into 'depot_tools'...
error: repository lacks the necessary blob to perform 3-way merge.
Falling back to direct application...
Run echo "$(pwd)/depot_tools" >> $GITHUB_PATH
Run node src/electron/script/generate-deps-hash.js && cat src/electron/.depshash-target
linux
undefined
undefined
undefined
undefined
undefined
all.gn--86c4a79557a8b40d6dbf76f080367028df2e3139
ffmpeg.gn--7a28cc9afd79d9f6afb5ec11c019fbed6e2100c2
native_tests.gn--6fe4aeba3bd23b0518e9109a9b658617d304b3da
release.gn--c2cbf00c47d07da1e503c58fe744b241757e8558
testing.gn--262c97a58a875813c8f29cb30a475682dd948311
Run cache_path=/mnt/cross-instance-cache/$DEPSHASH.tar
Using cache key: v1-src-cache-c18efec110f582a0258fc0d953c857b1c35639e9
Checking for cache in: /mnt/cross-instance-cache/v1-src-cache-c18efec110f582a0258fc0d953c857b1c35639e9.tar
Cache Already Exists for v1-src-cache-c18efec110f582a0258fc0d953c857b1c35639e9, Skipping..

curl -sSL "https://mempool.space/api/v1/services/accelerator/accelerations"


<img width="1512" alt="app-shot" src="https://github.com/user-attachments/assets/fb8cea15-bd1b-45cc-a77a-8a29b4a84016">

[java (2).md](https://github.com/user-attachments/files/16842119/java.2.md)


<img width="1512" alt="app-shot" src="https://github.com/user-attachments/assets/6cec8686-72a0-4620-939c-8696b5fbe262">
