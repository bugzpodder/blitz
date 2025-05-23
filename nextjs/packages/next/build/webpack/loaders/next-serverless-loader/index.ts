import devalue from 'next/dist/compiled/devalue'
import escapeRegexp from 'next/dist/compiled/escape-string-regexp'
import { join } from 'path'
import { parse } from 'querystring'
import { webpack } from 'next/dist/compiled/webpack/webpack'
import { API_ROUTE } from '../../../../lib/constants'
import { isDynamicRoute } from '../../../../shared/lib/router/utils'
import { __ApiPreviewProps } from '../../../../server/api-utils'
import {
  BUILD_MANIFEST,
  ROUTES_MANIFEST,
  REACT_LOADABLE_MANIFEST,
} from '../../../../shared/lib/constants'
import { trace } from '../../../../telemetry/trace'
import { normalizePathSep } from '../../../../server/normalize-page-path'
import { getSessionCookiePrefix } from '../../../../server/lib/utils'
import { loadConfigProduction } from '../../../../server/config-shared'

export type ServerlessLoaderQuery = {
  page: string
  pagesDir: string
  distDir: string
  absolutePagePath: string
  absoluteAppPath: string
  absoluteDocumentPath: string
  absoluteErrorPath: string
  absolute404Path: string
  buildId: string
  assetPrefix: string
  generateEtags: string
  poweredByHeader: string
  canonicalBase: string
  basePath: string
  runtimeConfig: string
  previewProps: string
  loadedEnvFiles: string
  i18n: string
}

const nextServerlessLoader: webpack.loader.Loader = function () {
  const loaderSpan = trace('next-serverless-loader')
  return loaderSpan.traceFn(() => {
    const {
      distDir,
      absolutePagePath,
      page,
      pagesDir: rawPagesDir,
      buildId,
      canonicalBase,
      assetPrefix,
      absoluteAppPath,
      absoluteDocumentPath,
      absoluteErrorPath,
      absolute404Path,
      generateEtags,
      poweredByHeader,
      basePath,
      runtimeConfig,
      previewProps,
      loadedEnvFiles,
      i18n,
    }: ServerlessLoaderQuery =
      typeof this.query === 'string' ? parse(this.query.substr(1)) : this.query

    const pagesDir = normalizePathSep(rawPagesDir)

    const sessionCookiePrefix = getSessionCookiePrefix(
      loadConfigProduction(pagesDir)
    )

    const setEnvCode = `
      process.env.BLITZ_APP_DIR = process.env.VERCEL && !process.env.CI
        ? '/var/task/'
        : "${pagesDir}"
      process.env.__BLITZ_SESSION_COOKIE_PREFIX = "${sessionCookiePrefix}"
    `

    const buildManifest = join(distDir, BUILD_MANIFEST).replace(/\\/g, '/')
    const reactLoadableManifest = join(
      distDir,
      REACT_LOADABLE_MANIFEST
    ).replace(/\\/g, '/')
    const routesManifest = join(distDir, ROUTES_MANIFEST).replace(/\\/g, '/')

    const escapedBuildId = escapeRegexp(buildId)
    const pageIsDynamicRoute = isDynamicRoute(page)

    const encodedPreviewProps = devalue(
      JSON.parse(previewProps) as __ApiPreviewProps
    )

    const envLoading = `
      const { processEnv } = require('@next/env')
      processEnv(${Buffer.from(loadedEnvFiles, 'base64').toString()})
    `

    const runtimeConfigImports = runtimeConfig
      ? `
        const { setConfig } = require('next/config')
      `
      : ''

    const runtimeConfigSetter = runtimeConfig
      ? `
        const runtimeConfig = ${runtimeConfig}
        setConfig(runtimeConfig)
      `
      : 'const runtimeConfig = {}'

    if (page.match(API_ROUTE)) {
      return `
        ${envLoading}
        ${runtimeConfigImports}
        ${
          /*
            this needs to be called first so its available for any other imports
          */
          runtimeConfigSetter
        }
        import 'next/dist/server/node-polyfill-fetch'
        import routesManifest from '${routesManifest}'

        import { getApiHandler } from 'next/dist/build/webpack/loaders/next-serverless-loader/api-handler'

        ${setEnvCode}

        const combinedRewrites = Array.isArray(routesManifest.rewrites)
          ? routesManifest.rewrites
          : []

        if (!Array.isArray(routesManifest.rewrites)) {
          combinedRewrites.push(...routesManifest.rewrites.beforeFiles)
          combinedRewrites.push(...routesManifest.rewrites.afterFiles)
          combinedRewrites.push(...routesManifest.rewrites.fallback)
        }

        const apiHandler = getApiHandler({
          pageModule: require("${absolutePagePath}"),
          rewrites: combinedRewrites,
          i18n: ${i18n || 'undefined'},
          page: "${page}",
          basePath: "${basePath}",
          pageIsDynamic: ${pageIsDynamicRoute},
          encodedPreviewProps: ${encodedPreviewProps},
        })
        export default apiHandler
      `
    } else {
      return `
      import 'next/dist/server/node-polyfill-fetch'
      import routesManifest from '${routesManifest}'
      import buildManifest from '${buildManifest}'
      import reactLoadableManifest from '${reactLoadableManifest}'

      ${envLoading}
      ${runtimeConfigImports}
      ${
        // this needs to be called first so its available for any other imports
        runtimeConfigSetter
      }
      import { getPageHandler } from 'next/dist/build/webpack/loaders/next-serverless-loader/page-handler'

      ${setEnvCode}

      const documentModule = require("${absoluteDocumentPath}")

      const appMod = require('${absoluteAppPath}')
      let App = appMod.default || appMod.then && appMod.then(mod => mod.default);

      const compMod = require('${absolutePagePath}')

      const Component = compMod.default || compMod.then && compMod.then(mod => mod.default)
      export default Component
      export const getStaticProps = compMod['getStaticProp' + 's'] || compMod.then && compMod.then(mod => mod['getStaticProp' + 's'])
      export const getStaticPaths = compMod['getStaticPath' + 's'] || compMod.then && compMod.then(mod => mod['getStaticPath' + 's'])
      export const getServerSideProps = compMod['getServerSideProp' + 's'] || compMod.then && compMod.then(mod => mod['getServerSideProp' + 's'])

      // kept for detecting legacy exports
      export const unstable_getStaticParams = compMod['unstable_getStaticParam' + 's'] || compMod.then && compMod.then(mod => mod['unstable_getStaticParam' + 's'])
      export const unstable_getStaticProps = compMod['unstable_getStaticProp' + 's'] || compMod.then && compMod.then(mod => mod['unstable_getStaticProp' + 's'])
      export const unstable_getStaticPaths = compMod['unstable_getStaticPath' + 's'] || compMod.then && compMod.then(mod => mod['unstable_getStaticPath' + 's'])
      export const unstable_getServerProps = compMod['unstable_getServerProp' + 's'] || compMod.then && compMod.then(mod => mod['unstable_getServerProp' + 's'])

      export let config = compMod['confi' + 'g'] || (compMod.then && compMod.then(mod => mod['confi' + 'g'])) || {}
      export const _app = App

      const combinedRewrites = Array.isArray(routesManifest.rewrites)
        ? routesManifest.rewrites
        : []

      if (!Array.isArray(routesManifest.rewrites)) {
        combinedRewrites.push(...routesManifest.rewrites.beforeFiles)
        combinedRewrites.push(...routesManifest.rewrites.afterFiles)
        combinedRewrites.push(...routesManifest.rewrites.fallback)
      }

      const { renderReqToHTML, render } = getPageHandler({
        pageModule: compMod,
        pageComponent: Component,
        pageConfig: config,
        appModule: App,
        documentModule: documentModule,
        errorModule: require("${absoluteErrorPath}"),
        notFoundModule: ${
          absolute404Path ? `require("${absolute404Path}")` : undefined
        },
        pageGetStaticProps: getStaticProps,
        pageGetStaticPaths: getStaticPaths,
        pageGetServerSideProps: getServerSideProps,

        assetPrefix: "${assetPrefix}",
        canonicalBase: "${canonicalBase}",
        generateEtags: ${generateEtags || 'false'},
        poweredByHeader: ${poweredByHeader || 'false'},

        runtimeConfig,
        buildManifest,
        reactLoadableManifest,

        rewrites: combinedRewrites,
        i18n: ${i18n || 'undefined'},
        page: "${page}",
        buildId: "${buildId}",
        escapedBuildId: "${escapedBuildId}",
        basePath: "${basePath}",
        pageIsDynamic: ${pageIsDynamicRoute},
        encodedPreviewProps: ${encodedPreviewProps}
      })
      export { renderReqToHTML, render }
    `
    }
  })
}

export default nextServerlessLoader
