provider "azurerm" {
  features {}
}

resource "random_id" "baghazurerm_suffix_gen" {
        byte_length = 6
    }

resource "azurerm_resource_group" "baghazurerm_resource_group" {
  name = "baghazurerm_resource_group-${random_id.baghazurerm_suffix_gen.hex}"
  location = "India Central"
   }

resource "azurerm_virtual_network" "baghazurerm_virtual_network" {
  name = "baghazurerm_virtual_network-${random_id.baghazurerm_suffix_gen.hex}"
  resource_group = azurerm_resource_group.baghazurerm_resource_group.name
  location = azurerm_resource_group.baghazurerm_resource_group.location
  address_space       = ["10.0.0.0/16"]
}
  
