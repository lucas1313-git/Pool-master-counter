import Capacitor
import StoreKit

/// Local (app-bundled, not npm-distributed) Capacitor plugin bridging
/// StoreKit 2 to the shared web app's paywall (js/app.js,
/// requireProOrShowPaywall / IS_NATIVE / Purchases). Backs exactly one
/// product for now - which features actually stay gated long-term is
/// still undecided; this is the mechanism, tested against Products.storekit
/// (StoreKit Testing, wired into the App scheme) rather than real App
/// Store Connect products until there's real pricing/copy to ship.
@objc(PurchasesPlugin)
public class PurchasesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PurchasesPlugin"
    public let jsName = "Purchases"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isProUnlocked", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchasePro", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restorePurchases", returnType: CAPPluginReturnPromise)
    ]

    static let proProductID = "com.poolmastercounter.app.pro"

    /// Reports both the current entitlement AND the product's real
    /// display price (e.g. "$4.99") in one call, so the JS side's paywall
    /// can show a real price without a second round trip - also doubles
    /// as the "did the StoreKit config actually load" signal: `price` is
    /// nil if the product couldn't be fetched at all.
    @objc func isProUnlocked(_ call: CAPPluginCall) {
        Task {
            let unlocked = await Self.checkEntitlement()
            var result: [String: Any] = ["unlocked": unlocked]
            // Boxing an Optional directly into [String: Any] trips up
            // JSON serialization when it's genuinely nil (Optional.none
            // as Any isn't NSNull) - only set the key when there's a
            // real value instead.
            if let price = try? await Self.fetchProduct()?.displayPrice {
                result["price"] = price
            }
            call.resolve(result)
        }
    }

    @objc func purchasePro(_ call: CAPPluginCall) {
        Task {
            do {
                guard let product = try await Self.fetchProduct() else {
                    call.reject("Pro product not found - is Products.storekit wired into the scheme?")
                    return
                }
                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    if case .verified = verification {
                        call.resolve(["unlocked": true])
                    } else {
                        call.resolve(["unlocked": false])
                    }
                case .userCancelled:
                    call.resolve(["unlocked": false, "cancelled": true])
                case .pending:
                    call.resolve(["unlocked": false, "pending": true])
                @unknown default:
                    call.resolve(["unlocked": false])
                }
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func restorePurchases(_ call: CAPPluginCall) {
        Task {
            try? await AppStore.sync()
            let unlocked = await Self.checkEntitlement()
            call.resolve(["unlocked": unlocked])
        }
    }

    static func fetchProduct() async throws -> Product? {
        try await Product.products(for: [proProductID]).first
    }

    static func checkEntitlement() async -> Bool {
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result, transaction.productID == proProductID {
                return true
            }
        }
        return false
    }
}

/// CAPBridgedPlugin conformance alone does NOT auto-register a plugin
/// that's defined locally in the app (only plugins shipped as a proper
/// Capacitor Pod/SPM package get picked up that way) - confirmed by
/// checking window.Capacitor.Plugins/.PluginHeaders from JS, which only
/// ever listed Capacitor's own built-in plugins (CapacitorHttp, Console,
/// WebView, CapacitorCookies, SystemBars) until this explicit
/// registration was added. This is the documented pattern for a local
/// plugin: subclass CAPBridgeViewController, register in
/// capacitorDidLoad() (SceneDelegate.swift uses this class instead of
/// CAPBridgeViewController directly).
class MainBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PurchasesPlugin())
    }
}
