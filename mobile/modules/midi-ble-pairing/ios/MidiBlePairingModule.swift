import ExpoModulesCore
import CoreAudioKit

public class MidiBlePairingModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MidiBlePairing")

    AsyncFunction("presentPairing") { (promise: Promise) in
      let controller = CABTMIDICentralViewController()
      let navigation = UINavigationController(rootViewController: controller)
      controller.navigationItem.rightBarButtonItem = UIBarButtonItem(
        systemItem: .done,
        primaryAction: UIAction { [weak navigation] _ in
          navigation?.dismiss(animated: true)
        }
      )
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject("ERR_NO_VIEW_CONTROLLER", "No view controller available to present from")
        return
      }
      presenter.present(navigation, animated: true) {
        promise.resolve(nil)
      }
    }.runOnQueue(.main)
  }
}
