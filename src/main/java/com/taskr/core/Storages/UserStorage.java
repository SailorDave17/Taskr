package com.taskr.core.Storages;

import com.taskr.core.Resources.User;
import org.springframework.stereotype.Service;


@Service
public class UserStorage {

    private UserRepository userRepo;

    public UserStorage(UserRepository userRepo) {
        this.userRepo = userRepo;
    }

    public void save(User user) {
        userRepo.save(user);
    }

    public Iterable<User> findAll() {
        return userRepo.findAll();
    }

    public User findById(Long id) {
        if (userRepo.findById(id).isPresent()) {
            return userRepo.findById(id).get();
        }
        else return null;
    }
}
