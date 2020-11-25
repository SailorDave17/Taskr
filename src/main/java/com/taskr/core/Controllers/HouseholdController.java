package com.taskr.core.Controllers;


import com.taskr.core.Resources.User;
import com.taskr.core.Storages.UserStorage;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HouseholdController {

    private UserStorage userStorage;

    public HouseholdController(UserStorage userStorage) {
        this.userStorage = userStorage;
    }

    @GetMapping("/api/household")
    public Iterable<User> retrieveAllHousehold(){
        return userStorage.findAll();
    }

    @GetMapping("/api/household/(id)")
    public User retrieveHouseholdById(Long id){
        return userStorage.findById(id);
    }
//  missing adding user to household
}
