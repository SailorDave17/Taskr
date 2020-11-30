package com.taskr.core.Storages;

import com.taskr.core.Resources.User;
import org.springframework.stereotype.Service;

import java.util.Optional;

@Service
public class UserStorage {

    private UserRepository userRepo;

    public UserStorage(UserRepository userRepo) {
        this.userRepo = userRepo;
    }

    public void save(User user) {
        userRepo.save(user);
    }

    public void deleteById(Long id) {
        userRepo.deleteById(id);
    }

    public void delete(User user) {
        userRepo.delete(user);
    }

    public Iterable<User> findAll() {
        return userRepo.findAll();
    }

    public User findById(Long id) {
        if (userRepo.findById(id).isPresent()) {
            return userRepo.findById(id).get();
        } else return null;
    }

    public User findUserByName(String name) {
        Optional<User> retrievedUserOptional = Optional.ofNullable(userRepo.findUserByName(name));
        if (retrievedUserOptional.isPresent()){
            return retrievedUserOptional.get();
        } else return null;
    }
}
